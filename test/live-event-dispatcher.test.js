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
