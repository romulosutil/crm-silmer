import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEAL_STAGES,
  createDealReadService,
} from '../modules/deals-pipeline/src/index.js';

const CURSOR_KEY = Buffer.alloc(32, 81);

/** @param {any} repository */
function service(repository) {
  return createDealReadService({ cursorKey: CURSOR_KEY, repository });
}

test('projects five independently paginated Kanban columns with signed bound cursors', async () => {
  const read = service({
    async getBoard(/** @type {any} */ input) {
      return input.stage === 'produto'
        ? {
            count: 3,
            hasMore: true,
            rows: [
              {
                id: 'deal-1',
                stage: 'produto',
                updatedAt: '2026-09-07T17:00:00.000Z',
              },
            ],
          }
        : { count: 0, hasMore: false, rows: [] };
    },
  });
  const result = await read.getBoard({ limit: 1 });
  assert.deepEqual(
    result.columns.map(({ stage }) => stage),
    DEAL_STAGES,
  );
  assert.deepEqual(
    result.columns.map(({ label }) => label),
    ['Produto', 'Especificação', 'Estampa', 'Logística', 'Fechamento'],
  );
  assert.equal(result.columns[0].count, 3);
  assert.ok(result.columns[0].nextCursor);
  assert.equal(result.columns[1].nextCursor, null);
  const column = await read.getColumn({
    cursor: result.columns[0].nextCursor,
    limit: 1,
    stage: 'produto',
  });
  assert.equal(column.stage, 'produto');
  await assert.rejects(
    read.getColumn({
      cursor: result.columns[0].nextCursor,
      limit: 1,
      stage: 'estampa',
    }),
    /cursor/u,
  );
  await assert.rejects(
    read.getColumn({
      assignedUserId: 'other',
      cursor: result.columns[0].nextCursor,
      limit: 1,
      stage: 'produto',
    }),
    /cursor/u,
  );
});

test('validates closed board filters and cursor input', async () => {
  const read = service({
    getBoard: async () => ({ hasMore: false, rows: [] }),
  });
  await assert.rejects(read.getBoard({ limit: 101 }), /limit/u);
  await assert.rejects(read.getColumn({ stage: 'backlog' }), /INVALID_STAGE/u);
  await assert.rejects(
    read.getColumn({ stage: 'produto', cursor: 'not-a-cursor' }),
    /cursor/u,
  );
  await assert.rejects(read.getBoard({ unknown: true }), /INVALID_FILTER/u);
});

test('returns stable detail ETags and 304 without loading the full projection', async () => {
  let detailLoads = 0;
  const read = service({
    async getDetail() {
      detailLoads += 1;
      return {
        deal: { id: 'deal-1', version: 7 },
        representationVersion: '7:task-a-v2:handoff-a-v1',
      };
    },
    async getVersion() {
      return '7:task-a-v2:handoff-a-v1';
    },
  });
  const fresh = await read.getDetail({ dealId: 'deal-1' });
  assert.match(fresh.etag, /^"deal-[A-Za-z0-9_-]+"$/u);
  assert.equal(
    'representationVersion' in /** @type {any} */ (fresh).detail,
    false,
  );
  assert.equal(
    (await read.getDetail({ dealId: 'deal-1', ifNoneMatch: fresh.etag }))
      .notModified,
    true,
  );
  assert.equal(detailLoads, 1);
});

test('replays canonical events monotonically and resets on gap or replay limit', async () => {
  const batches = [
    { latestCursor: 8, minimumCursor: 5, rows: [] },
    {
      latestCursor: 20,
      minimumCursor: 1,
      rows: [{ cursor: 2 }, { cursor: 3 }],
      hasMore: true,
    },
    {
      latestCursor: 4,
      minimumCursor: 1,
      rows: [{ cursor: 4, dealId: 'deal-1', type: 'deal.assigned' }],
      hasMore: false,
    },
  ];
  const read = service({ readEvents: async () => batches.shift() });
  assert.deepEqual((await read.readEvents({ after: 2, limit: 10 })).reset, {
    reason: 'retention_gap',
  });
  assert.deepEqual((await read.readEvents({ after: 1, limit: 2 })).reset, {
    reason: 'replay_limit',
  });
  const replay = await read.readEvents({ after: 3, limit: 10 });
  assert.equal(replay.cursor, 4);
  assert.equal(replay.events[0].dealId, 'deal-1');
});

test('resets invalid and cross-topic SSE cursors without enumerating events', async () => {
  /** @type {any[]} */
  const calls = [];
  const read = service({
    async readEvents(/** @type {any} */ input) {
      calls.push(input);
      return { latestCursor: 12, minimumCursor: 1, rows: [] };
    },
  });
  assert.deepEqual((await read.readEvents({ after: 'invalid' })).reset, {
    reason: 'invalid_cursor',
  });
  assert.deepEqual(
    (await read.readEvents({ after: 2, topic: 'other' })).reset,
    { reason: 'invalid_topic' },
  );
  assert.deepEqual(calls, [
    { after: 0, limit: 1, topic: 'kanban' },
    { after: 0, limit: 1, topic: 'kanban' },
  ]);
});
