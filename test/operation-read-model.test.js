import assert from 'node:assert/strict';
import test from 'node:test';

import { createOperationReadService } from '../apps/api/src/operation-runtime.js';

function serviceHarness() {
  const calls = /** @type {Array<[string, any]>} */ ([]);
  const inboxRepository = {
    async get(/** @type {string} */ id) {
      calls.push(['get-inbox', id]);
      return { conversation: { id } };
    },
    async list(/** @type {any} */ input) {
      calls.push(['list-inbox', input]);
      return {
        hasMore: true,
        items: [
          {
            id: 'conversation-1',
            updatedAt: '2026-09-08T12:00:00.000Z',
          },
        ],
        totalCount: 2,
      };
    },
  };
  const contactRepository = {
    async get(/** @type {string} */ id) {
      calls.push(['get-contact', id]);
      return { contact: { id } };
    },
    async list(/** @type {any} */ input) {
      calls.push(['list-contacts', input]);
      return {
        hasMore: true,
        items: [{ id: 'contact-1', updatedAt: '2026-09-08T11:00:00.000Z' }],
        totalCount: 3,
      };
    },
  };
  const handoffRepository = {
    async listOpen(/** @type {any} */ input) {
      calls.push(['list-handoffs', input]);
      return {
        hasMore: true,
        items: [
          {
            id: 'handoff-1',
            updatedAt: '2026-09-08T13:00:00.000Z',
          },
        ],
        totalCount: 2,
      };
    },
  };
  return {
    calls,
    service: createOperationReadService({
      contactRepository,
      cursorKey: Buffer.alloc(32, 77),
      handoffRepository,
      inboxRepository,
    }),
  };
}

test('binds signed Inbox cursors to closed filters', async () => {
  const { calls, service } = serviceHarness();
  const first = await service.listInbox({
    channel: 'whatsapp',
    limit: 20,
    state: 'requer_atencao',
  });
  assert.equal(first.totalCount, 2);
  assert.ok(first.nextCursor);
  assert.deepEqual(calls[0], [
    'list-inbox',
    {
      after: null,
      channel: 'whatsapp',
      limit: 20,
      state: 'requer_atencao',
    },
  ]);

  await service.listInbox({
    channel: 'whatsapp',
    cursor: first.nextCursor,
    limit: 20,
    state: 'requer_atencao',
  });
  assert.deepEqual(calls[1][1].after, {
    id: 'conversation-1',
    updatedAt: '2026-09-08T12:00:00.000Z',
  });
  await assert.rejects(
    service.listInbox({
      channel: 'instagram',
      cursor: first.nextCursor,
      state: 'requer_atencao',
    }),
    (error) => /** @type {any} */ (error).code === 'INVALID_CURSOR',
  );
});

test('binds handoff cursors to the pending queue scope', async () => {
  const { calls, service } = serviceHarness();
  const first = await service.listOpenHandoffs({ limit: 20 });
  assert.equal(first.totalCount, 2);
  assert.ok(first.nextCursor);
  assert.deepEqual(calls[0], ['list-handoffs', { after: null, limit: 20 }]);

  await service.listOpenHandoffs({ cursor: first.nextCursor, limit: 20 });
  assert.deepEqual(calls[1], [
    'list-handoffs',
    {
      after: {
        id: 'handoff-1',
        updatedAt: '2026-09-08T13:00:00.000Z',
      },
      limit: 20,
    },
  ]);
  await assert.rejects(
    service.listInbox({ cursor: first.nextCursor }),
    (error) => /** @type {any} */ (error).code === 'INVALID_CURSOR',
  );
});

test('rejects unsupported Inbox filter values before persistence', async () => {
  const { calls, service } = serviceHarness();
  await assert.rejects(
    service.listInbox({ automationState: 'paused' }),
    (error) => /** @type {any} */ (error).code === 'INVALID_FILTER',
  );
  await assert.rejects(
    service.listInbox({ state: 'lost' }),
    (error) => /** @type {any} */ (error).code === 'INVALID_FILTER',
  );
  assert.deepEqual(calls, []);
});

test('uses a separate cursor scope for Contact pages', async () => {
  const { calls, service } = serviceHarness();
  const first = await service.listContacts({});
  assert.ok(first.nextCursor);
  assert.deepEqual(calls[0], ['list-contacts', { after: null, limit: 50 }]);
  await service.listContacts({ cursor: first.nextCursor, limit: 10 });
  assert.deepEqual(calls[1][1], {
    after: {
      id: 'contact-1',
      updatedAt: '2026-09-08T11:00:00.000Z',
    },
    limit: 10,
  });
  await assert.rejects(
    service.listInbox({ cursor: first.nextCursor }),
    (error) => /** @type {any} */ (error).code === 'INVALID_CURSOR',
  );
});
