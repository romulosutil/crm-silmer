import assert from 'node:assert/strict';
import test from 'node:test';

import { LiveEventDispatcher } from '../apps/api/src/live-event-dispatcher.js';

test('a reconnecting subscriber behind the shared cursor receives a reset', () => {
  const dispatcher = new LiveEventDispatcher({
    /** @param {{after:number}} input */
    async readLiveEvents({ after }) {
      return { cursor: after, events: [], reset: false };
    },
  });
  dispatcher.cursor = 120;
  /** @type {any[]} */
  const received = [];

  const unsubscribe = dispatcher.subscribe((event) => received.push(event), 80);
  assert.deepEqual(received, [
    {
      cursor: 120,
      payload: { cursor: 120 },
      type: 'stream.reset',
    },
  ]);
  unsubscribe();
});

test('a subscriber already at the shared cursor is not reset', () => {
  const dispatcher = new LiveEventDispatcher({
    /** @param {{after:number}} input */
    async readLiveEvents({ after }) {
      return { cursor: after, events: [], reset: false };
    },
  });
  dispatcher.cursor = 120;
  /** @type {any[]} */
  const received = [];

  const unsubscribe = dispatcher.subscribe(
    (event) => received.push(event),
    120,
  );
  assert.deepEqual(received, []);
  unsubscribe();
});

test('a future client cursor is reset only when the database is actually behind', async () => {
  let head = 500;
  const dispatcher = new LiveEventDispatcher({
    /** @param {{after:number}} input */
    async readLiveEvents({ after }) {
      return {
        cursor: head < after || head >= after + 100 ? head : after,
        events: [],
        reset: head < after || head >= after + 100,
      };
    },
  });
  assert.equal(await dispatcher.reconcileAhead(500), null);
  assert.equal(dispatcher.cursor, 500);

  // A normal large backlog also returns reset, but moves the cursor forward.
  head = 700;
  dispatcher.cursor = 0;
  assert.equal(await dispatcher.reconcileAhead(500), null);
  assert.equal(dispatcher.cursor, 0);

  head = 100;
  assert.deepEqual(await dispatcher.reconcileAhead(500), {
    cursor: 100,
    payload: { cursor: 100 },
    type: 'stream.reset',
  });
  assert.equal(dispatcher.cursor, 100);
});

test('a running dispatcher recovers after a database rewind', async () => {
  const dispatcher = new LiveEventDispatcher({
    async readLiveEvents() {
      return { cursor: 100, events: [], reset: true };
    },
  });
  dispatcher.cursor = 500;
  /** @type {any[]} */
  const received = [];
  dispatcher.listeners.add((/** @type {any} */ event) => received.push(event));
  await dispatcher.poll();
  assert.equal(dispatcher.cursor, 100);
  assert.deepEqual(received, [
    {
      cursor: 100,
      payload: { cursor: 100 },
      type: 'stream.reset',
    },
  ]);
});
