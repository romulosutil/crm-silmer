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
