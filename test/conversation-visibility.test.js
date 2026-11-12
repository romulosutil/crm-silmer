import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createOperationReadService } from '../apps/api/src/operation-runtime.js';
import { registerOperationRoutes } from '../apps/api/src/operation-routes.js';
import {
  canReadConversation,
  conversationReadScope,
} from '../modules/identity-access/src/authorization.js';
import { PostgresInboxReadRepository } from '../modules/inbox-channels/src/index.js';

const SELLER = Object.freeze({
  id: 'seller-a',
  functionName: 'Vendedor',
  kind: 'human',
  capabilities: [],
});
const ADMIN = Object.freeze({ ...SELLER, capabilities: ['COMMERCIAL_ADMIN'] });

/** @param {Record<string, string|null>} owners */
function visibilityHarness(owners) {
  const queries = /** @type {Array<{sql:string,values:any[]}>} */ ([]);
  const repository = new PostgresInboxReadRepository({
    contactEnvelopeKey: Buffer.alloc(32, 1),
    messageEnvelopeKey: Buffer.alloc(32, 2),
    database: {
      async query(/** @type {string} */ sql, /** @type {any[]} */ values) {
        queries.push({ sql, values });
        assert.match(
          sql,
          /assigned_user_id/u,
          'the repository must enforce ownership in SQL',
        );
        assert.equal(values.length, 2);
        const [id, reader] = values;
        const owner = owners[id];
        return {
          rows:
            id in owners &&
            (reader === null || owner === null || owner === reader)
              ? [{ id }]
              : [],
        };
      },
    },
  });
  const service = createOperationReadService({
    contactRepository: {},
    cursorKey: Buffer.alloc(32, 3),
    handoffRepository: {},
    inboxRepository: repository,
  });
  return { queries, repository, service };
}

test('CONV-ACL-01: only active human sellers read own/unassigned conversations; administrators read every owner', () => {
  assert.equal(canReadConversation(SELLER, SELLER.id), true);
  assert.equal(canReadConversation(SELLER, null), true);
  assert.equal(canReadConversation(SELLER, 'seller-b'), false);
  assert.equal(canReadConversation(SELLER, undefined), false);
  assert.equal(canReadConversation(ADMIN, 'seller-b'), true);
  assert.deepEqual(conversationReadScope(SELLER), {
    actorId: SELLER.id,
    readAll: false,
  });
  assert.deepEqual(conversationReadScope(ADMIN), {
    actorId: ADMIN.id,
    readAll: true,
  });
  for (const actor of [
    null,
    {},
    { ...ADMIN, kind: 'assistant' },
    { ...ADMIN, disabledAt: '2026-11-12T00:00:00Z' },
    { ...ADMIN, functionName: 'Financeiro' },
  ]) {
    assert.equal(canReadConversation(actor, null), false);
    assert.equal(canReadConversation(actor, 'seller-b'), false);
    assert.throws(() => conversationReadScope(actor), {
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  }
});

test('CONV-ACL-01: hidden detail and assistant context stop before querying messages, suggestions or turns', async () => {
  const { queries, service } = visibilityHarness({ hidden: 'seller-b' });
  const access = { actorId: SELLER.id, capabilities: [] };
  await assert.rejects(
    service.getConversation({ conversationId: 'hidden' }, access),
    { code: 'CONVERSATION_NOT_FOUND', statusCode: 404 },
  );
  assert.equal(
    queries.length,
    1,
    'a denied detail must not fetch encrypted message bodies',
  );
  assert.deepEqual(queries[0].values, ['hidden', SELLER.id]);
  await assert.rejects(
    service.getAssistantContext({ conversationId: 'hidden' }, access),
    { code: 'CONVERSATION_NOT_FOUND', statusCode: 404 },
  );
  assert.equal(
    queries.length,
    2,
    'a denied context must not fetch any turn or message count',
  );
  assert.deepEqual(queries[1].values, ['hidden', SELLER.id]);
});

test('CONV-ACL-01: realtime visibility is checked against current ownership and never discloses hidden identifiers', async () => {
  const owners = /** @type {Record<string, string|null>} */ ({
    own: SELLER.id,
    free: null,
    hidden: 'seller-b',
  });
  const { service } = visibilityHarness(owners);
  for (const conversationId of ['own', 'free']) {
    const event = {
      cursor: 1,
      type: 'inbox.conversation.changed',
      payload: { conversationId },
    };
    assert.deepEqual(await service.eventForReader(event, SELLER), event);
  }
  const hiddenEvent = {
    cursor: 2,
    type: 'inbox.order.changed',
    payload: { conversationId: 'hidden', orderId: 'hidden-order' },
  };
  assert.deepEqual(await service.eventForReader(hiddenEvent, SELLER), {
    cursor: 2,
    type: 'stream.reset',
    payload: {},
  });
  assert.deepEqual(
    await service.eventForReader(hiddenEvent, ADMIN),
    hiddenEvent,
  );
  owners.own = 'seller-b';
  const transfer = {
    cursor: 3,
    type: 'inbox.conversation.changed',
    payload: { conversationId: 'own' },
  };
  assert.deepEqual(await service.eventForReader(transfer, SELLER), {
    cursor: 3,
    type: 'stream.reset',
    payload: {},
  });
  assert.deepEqual(
    await service.eventForReader(
      {
        cursor: 4,
        type: 'inbox.contact.changed',
        payload: { contactId: 'private-contact' },
      },
      SELLER,
    ),
    { cursor: 4, type: 'stream.reset', payload: {} },
  );
});

test('CONV-ACL-01: SSE writes a generic invalidation after a transfer and keeps allowed event payloads', async () => {
  const { service } = visibilityHarness({ own: SELLER.id, hidden: 'seller-b' });
  let handler = /** @type {any} */ (null);
  let release = /** @type {(value:any)=>void} */ (() => {});
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  registerOperationRoutes(
    /** @type {any} */ ({
      get(
        /** @type {string} */ path,
        /** @type {any} */ options,
        /** @type {any} */ callback,
      ) {
        if (path === '/api/v1/events') handler = callback ?? options;
      },
      post() {},
      put() {},
    }),
    {
      authorizeRead: async () => ({ actor: SELLER }),
      readLiveEvents: async () => pending,
      eventForReader: service.eventForReader,
    },
    () => ({ requestId: 'synthetic-acl', correlationId: 'synthetic-acl' }),
  );
  const request = {
    headers: {},
    query: { after: '0', topic: 'inbox' },
    raw: new EventEmitter(),
  };
  const writes = /** @type {string[]} */ ([]);
  const reply = {
    hijack() {},
    raw: Object.assign(new EventEmitter(), {
      writeHead() {},
      write(/** @type {string} */ value) {
        writes.push(value);
      },
    }),
  };
  try {
    await handler(request, reply);
    release({
      cursor: 2,
      reset: false,
      events: [
        {
          cursor: 1,
          type: 'inbox.conversation.changed',
          payload: { conversationId: 'own' },
        },
        {
          cursor: 2,
          type: 'inbox.order.changed',
          payload: { conversationId: 'hidden', orderId: 'hidden-order' },
        },
      ],
    });
    await new Promise((resolve) => globalThis.setImmediate(resolve));
    const body = writes.join('');
    assert.match(body, /event: inbox\.conversation\.changed/u);
    assert.match(body, /"conversationId":"own"/u);
    assert.match(body, /id: 2\nevent: stream\.reset\ndata: \{\}/u);
    assert.doesNotMatch(body, /hidden|hidden-order/u);
  } finally {
    request.raw.emit('close');
  }
});

test('CONV-ACL-01: cursors are invalid after changing reader or administrative access', async () => {
  let listCalls = 0;
  const service = createOperationReadService({
    contactRepository: {},
    handoffRepository: {},
    cursorKey: Buffer.alloc(32, 4),
    inboxRepository: {
      async list() {
        listCalls += 1;
        return {
          hasMore: true,
          items: [{ id: 'page-one', updatedAt: '2026-11-12T10:00:00.000Z' }],
          totalCount: 2,
        };
      },
    },
  });
  const first = await service.listInbox(
    { limit: 1 },
    { actorId: SELLER.id, capabilities: [] },
  );
  assert.ok(first.nextCursor);
  for (const access of [
    { actorId: 'seller-b', capabilities: [] },
    { actorId: SELLER.id, capabilities: ['COMMERCIAL_ADMIN'] },
  ]) {
    await assert.rejects(
      service.listInbox({ limit: 1, cursor: first.nextCursor }, access),
      { code: 'INVALID_CURSOR' },
    );
  }
  assert.equal(
    listCalls,
    1,
    'a cursor from another scope must not query the repository',
  );
});
