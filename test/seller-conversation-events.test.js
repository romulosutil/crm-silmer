import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createOperationReadService } from '../apps/api/src/operation-runtime.js';
import { registerOperationRoutes } from '../apps/api/src/operation-routes.js';

const actor = { id: 'synthetic-seller', capabilities: [] };

test('WAP-E04: event projection strips values and secrets for every reader including Admin', async () => {
  const service = createOperationReadService({
    cursorKey: Buffer.alloc(32, 8),
    contactRepository: { get: async () => ({}) },
    inboxRepository: { assertReadable: async () => {} },
    handoffRepository: {},
  });
  for (const reader of [
    actor,
    { ...actor, capabilities: ['COMMERCIAL_ADMIN'] },
  ]) {
    assert.deepEqual(
      await service.eventForReader(
        {
          cursor: 1,
          type: 'inbox.conversation.changed',
          payload: {
            conversationId: 'synthetic-chat',
            contactId: 'private-contact',
            qr: 'synthetic-qr',
            document: 'synthetic-document',
            text: 'private-body',
          },
        },
        reader,
      ),
      {
        cursor: 1,
        type: 'inbox.conversation.changed',
        payload: { conversationId: 'synthetic-chat' },
      },
    );
    assert.deepEqual(
      await service.eventForReader(
        { cursor: 2, type: 'whatsapp.qr', payload: { qr: 'synthetic-qr' } },
        reader,
      ),
      { cursor: 2, type: 'stream.reset', payload: {} },
    );
  }
});

test('WAP-E04: Inbox and handoff cursors cannot cross current access scope after revocation', async () => {
  let version = 'before';
  let reads = 0;
  const page = async () => {
    reads++;
    return {
      hasMore: true,
      items: [{ id: 'synthetic-row', updatedAt: '2026-11-17T12:00:00.000Z' }],
      totalCount: 2,
    };
  };
  const service = createOperationReadService({
    cursorKey: Buffer.alloc(32, 9),
    contactRepository: {},
    inboxRepository: { list: page },
    handoffRepository: { listOpen: page },
    database: { query: async () => ({ rows: [{ version }] }) },
  });
  const access = { actorId: actor.id, capabilities: [] };
  const inbox = await service.listInbox({ limit: 1 }, access);
  const handoffs = await service.listOpenHandoffs({ limit: 1 }, access);
  version = 'after';
  await assert.rejects(
    service.listInbox({ limit: 1, cursor: inbox.nextCursor }, access),
    { code: 'INVALID_CURSOR' },
  );
  await assert.rejects(
    service.listOpenHandoffs({ limit: 1, cursor: handoffs.nextCursor }, access),
    { code: 'INVALID_CURSOR' },
  );
  assert.equal(reads, 2, 'stale cursors stop before reading either page');
});

test('WAP-E04: heartbeat invalidates open projections on scope loss without an aggregate event', async (t) => {
  const callbacks = /** @type {Function[]} */ ([]);
  t.mock.method(
    globalThis,
    'setInterval',
    (/** @type {Function} */ callback) => {
      callbacks.push(callback);
      return { unref() {} };
    },
  );
  t.mock.method(globalThis, 'clearInterval', () => {});
  let scope = 'before';
  let authorized = true;
  let handler = /** @type {any} */ (null);
  const writes = /** @type {string[]} */ ([]);
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
      authorizeRead: async () => {
        if (!authorized) throw new Error('revoked');
        return { actor };
      },
      readAccessScope: async () => scope,
      readLiveEvents: async () => ({ cursor: 0, events: [], reset: false }),
    },
    () => ({ requestId: 'synthetic', correlationId: 'synthetic' }),
  );
  const request = { query: { after: 0 }, headers: {}, raw: new EventEmitter() };
  const reply = {
    hijack() {},
    raw: Object.assign(new EventEmitter(), {
      writeHead() {},
      write(/** @type {string} */ value) {
        writes.push(value);
      },
      end() {},
      destroy() {},
    }),
  };
  try {
    await handler(request, reply);
    scope = 'after';
    callbacks.at(-1)?.();
    await new Promise((resolve) => globalThis.setImmediate(resolve));
    assert.match(writes.join(''), /event: stream\.reset\ndata: \{\}/u);
    assert.doesNotMatch(writes.join(''), /synthetic-seller|before|after/u);
    authorized = false;
    callbacks.at(-1)?.();
    await new Promise((resolve) => globalThis.setImmediate(resolve));
    assert.match(writes.join(''), /event: session\.expired\ndata: \{\}/u);
  } finally {
    request.raw.emit('close');
  }
});
