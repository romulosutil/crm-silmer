import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MESSAGE_GROUP_GAP_MINUTES,
  breaksGroup,
  groupStarts,
  standsAlone,
} from '../apps/edge-web/src/components/inbox/message-groups.js';

// INBOX-RD-03 (RD-04): when consecutive messages share the author's header.
// Synthetic data only.

/** @param {number} minutes */
const at = (minutes) =>
  new Date(Date.UTC(2026, 10, 11, 15, 0) + minutes * 60_000).toISOString();
/** @param {string} id @param {number} minutes @param {Record<string, any>} [extra] */
const customer = (id, minutes, extra = {}) => ({
  id,
  authorKind: 'contact',
  direction: 'inbound',
  occurredAt: at(minutes),
  ...extra,
});
/** @param {string} id @param {number} minutes @param {Record<string, any>} [extra] */
const seller = (id, minutes, extra = {}) => ({
  id,
  authorKind: 'human',
  authorId: 'seller-a',
  direction: 'outbound',
  occurredAt: at(minutes),
  deliveryStatus: 'delivered',
  ...extra,
});
/** @param {string} id @param {number} minutes @param {Record<string, any>} [extra] */
const agent = (id, minutes, extra = {}) => ({
  id,
  authorKind: 'assistant',
  direction: 'outbound',
  occurredAt: at(minutes),
  ...extra,
});

test('consecutive messages of one author share a group', () => {
  const starts = groupStarts([
    customer('c1', 0),
    customer('c2', 1),
    customer('c3', 6),
  ]);
  assert.deepEqual([...starts], ['c1']);
});

test('a new author opens a group: seller and agent never share one', () => {
  const starts = groupStarts([
    customer('c1', 0),
    agent('a1', 1),
    agent('a2', 1),
    seller('s1', 2),
    seller('s2', 3, { authorId: 'seller-b' }),
    customer('c2', 4),
  ]);
  assert.deepEqual([...starts], ['c1', 'a1', 's1', 's2', 'c2']);
});

test('a new day opens a group even a minute later', () => {
  const late = customer('c1', 0, { occurredAt: '2026-11-11T23:59:00' });
  const early = customer('c2', 0, { occurredAt: '2026-11-12T00:00:30' });
  assert.equal(breaksGroup(late, early, MESSAGE_GROUP_GAP_MINUTES), true);
});

test('a pause longer than the limit opens a group; the limit itself does not', () => {
  assert.equal(MESSAGE_GROUP_GAP_MINUTES, 10);
  assert.deepEqual(
    [
      ...groupStarts([
        customer('c1', 0),
        customer('c2', 10),
        customer('c3', 21),
      ]),
    ],
    ['c1', 'c3'],
  );
});

test('a failed or uncertain send stands alone, before and after', () => {
  const failed = seller('s2', 1, { deliveryStatus: 'failed' });
  const uncertain = seller('s4', 3, { deliveryStatus: 'outcome_unknown' });
  assert.equal(standsAlone(failed), true);
  assert.equal(standsAlone(uncertain), true);
  assert.deepEqual(
    [
      ...groupStarts([
        seller('s1', 0),
        failed,
        seller('s3', 2),
        uncertain,
        seller('s5', 4),
        seller('s6', 5),
      ]),
    ],
    ['s1', 's2', 's3', 's4', 's5'],
  );
});

test('a system record stands alone; media keeps the group', () => {
  const system = {
    id: 'x1',
    authorKind: 'system',
    direction: 'outbound',
    occurredAt: at(1),
  };
  assert.equal(standsAlone(system), true);
  assert.deepEqual(
    [...groupStarts([agent('a1', 0), system, agent('a2', 2)])],
    ['a1', 'x1', 'a2'],
  );
  assert.deepEqual(
    [
      ...groupStarts([
        customer('c1', 0, { type: 'image', media: { kind: 'image' } }),
        customer('c2', 1, { type: 'image', media: { kind: 'image' } }),
        customer('c3', 2),
      ]),
    ],
    ['c1'],
  );
});

test('an older payload without authorKind groups by direction', () => {
  assert.deepEqual(
    [
      ...groupStarts([
        { id: 'm1', direction: 'inbound', occurredAt: at(0) },
        { id: 'm2', direction: 'inbound', occurredAt: at(1) },
        { id: 'm3', direction: 'outbound', occurredAt: at(2) },
      ]),
    ],
    ['m1', 'm3'],
  );
});

test('an unreadable time opens a group; no list gives no groups', () => {
  assert.deepEqual(
    [
      ...groupStarts([
        customer('c1', 0),
        customer('c2', 0, { occurredAt: 'x' }),
      ]),
    ],
    ['c1', 'c2'],
  );
  assert.deepEqual([...groupStarts(undefined)], []);
});
