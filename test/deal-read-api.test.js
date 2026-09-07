import assert from 'node:assert/strict';
import test from 'node:test';

import { createApi } from '../apps/api/src/app.js';
import { formatDealSseEvent } from '../apps/api/src/deal-routes.js';
import { createSafeLogger } from '../modules/shared/src/index.js';

function harness() {
  /** @type {any[]} */
  const calls = [];
  const deals = {
    /** @param {any} input */
    async authorizeRead(input) {
      calls.push(['authorize', input]);
      return { actor: { id: 'seller-1', kind: 'human' } };
    },
    /** @param {any} input */
    async getDealDetail(input) {
      calls.push(['detail', input]);
      return input.ifNoneMatch === '"known"'
        ? { etag: '"known"', notModified: true }
        : {
            detail: {
              deal: { id: input.dealId, stage: 'produto', version: 4 },
            },
            etag: '"fresh"',
            notModified: false,
          };
    },
    /** @param {any} input */
    async getKanbanBoard(input) {
      calls.push(['board', input]);
      return {
        columns: [
          {
            cards: [],
            count: 0,
            label: 'Produto',
            nextCursor: null,
            stage: 'produto',
          },
        ],
      };
    },
    /** @param {any} input */
    async getKanbanColumn(input) {
      calls.push(['column', input]);
      return {
        cards: [],
        count: 0,
        label: 'Produto',
        nextCursor: null,
        stage: input.stage,
      };
    },
  };
  const api = createApi(
    {},
    {
      deals,
      logger: createSafeLogger({ service: 'crm-silmer-api', sink: () => {} }),
    },
  );
  const headers = {
    cookie: 'crm_session=session',
    origin: 'https://crm.example.test',
  };
  return { api, calls, headers };
}

test('GET Kanban exposes per-column cursors and parses only structured filters', async () => {
  const { api, calls, headers } = harness();
  const board = await api.inject({
    headers,
    method: 'GET',
    url: '/api/v1/kanban?assignedUserId=seller-1&hasOverdueTask=false&limit=10',
  });
  assert.equal(board.statusCode, 200);
  assert.equal(board.headers['cache-control'], 'private, no-cache');
  assert.equal(board.headers.vary, 'Origin, Cookie');
  assert.deepEqual(calls[1], [
    'board',
    { assignedUserId: 'seller-1', hasOverdueTask: false, limit: 10 },
  ]);

  const column = await api.inject({
    headers,
    method: 'GET',
    url: '/api/v1/kanban/cards?stage=produto&cursor=signed&limit=5',
  });
  assert.equal(column.statusCode, 200);
  assert.deepEqual(calls[3], [
    'column',
    { cursor: 'signed', limit: 5, stage: 'produto' },
  ]);

  const rejected = await api.inject({
    headers,
    method: 'GET',
    url: '/api/v1/kanban?status=lost',
  });
  assert.equal(rejected.statusCode, 400);
  await api.close();
});

test('GET Deal returns ETag/304 and read authorization runs before lookup', async () => {
  const { api, calls, headers } = harness();
  const fresh = await api.inject({
    headers,
    method: 'GET',
    url: '/api/v1/deals/deal-1',
  });
  assert.equal(fresh.statusCode, 200);
  assert.equal(fresh.headers.etag, '"fresh"');
  const cached = await api.inject({
    headers: { ...headers, 'if-none-match': '"known"' },
    method: 'GET',
    url: '/api/v1/deals/deal-1',
  });
  assert.equal(cached.statusCode, 304);
  assert.equal(cached.body, '');
  assert.deepEqual(
    calls.slice(0, 2).map(([kind]) => kind),
    ['authorize', 'detail'],
  );
  await api.close();
});

test('SSE projection maps task and handoff changes to the owning Deal without raw payload', () => {
  for (const event of [
    {
      aggregateVersion: 3,
      cursor: 10,
      dealId: 'deal-1',
      occurredAt: '2026-09-07T17:00:00.000Z',
      payload: { private: 'must-not-leak' },
      type: 'task.completed',
    },
    {
      aggregateVersion: 4,
      cursor: 11,
      dealId: 'deal-2',
      occurredAt: '2026-09-07T17:01:00.000Z',
      payload: { private: 'must-not-leak' },
      type: 'handoff.resolved',
    },
  ]) {
    const frame = formatDealSseEvent(event);
    assert.match(frame, /event: kanban\.card\.changed/u);
    assert.match(frame, new RegExp(`"dealId":"${event.dealId}"`, 'u'));
    assert.doesNotMatch(frame, /must-not-leak|"private"/u);
  }
});
