import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveEventStream } from '../apps/edge-web/src/lib/event-stream.js';

test('named SSE event keeps its type when the payload contains only identifiers', () => {
  /** @type {Record<string, unknown>[]} */
  const changes = [];
  const stream = new LiveEventStream({
    onChange: (event) => changes.push(event),
    onReset: () => {},
    onState: () => {},
  });
  stream.consume(
    /** @type {MessageEvent} */ (
      /** @type {unknown} */ ({
        type: 'identity.user.changed',
        data: '{"userId":"user-1"}',
        lastEventId: 'cursor-2',
      })
    ),
    false,
  );
  assert.deepEqual(changes, [
    { userId: 'user-1', type: 'identity.user.changed' },
  ]);
  assert.equal(stream.cursor, 'cursor-2');
});

test('session expiration asks the shell to recheck access', () => {
  const previousSource = globalThis.EventSource;
  /** @type {Map<string, Function>} */
  const listeners = new Map();
  globalThis.EventSource = /** @type {any} */ (
    class {
      /** @param {string} name @param {Function} listener */
      addEventListener(name, listener) {
        listeners.set(name, listener);
      }
      close() {}
    }
  );
  let expired = 0;
  try {
    const stream = new LiveEventStream({
      onChange() {},
      onReset() {},
      onSessionExpired() {
        expired += 1;
      },
      onState() {},
    });
    stream.start();
    listeners.get('session.expired')?.({ lastEventId: 'cursor-3' });
    assert.equal(expired, 1);
    assert.equal(stream.cursor, 'cursor-3');
    stream.close();
  } finally {
    globalThis.EventSource = previousSource;
  }
});
