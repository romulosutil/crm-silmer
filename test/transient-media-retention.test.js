import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isTransientMediaExpired,
  resolveTransientMediaExpiresAt,
  TRANSIENT_MEDIA_MAX_AGE_DAYS,
  TransientMediaRetentionError,
} from '../modules/audit-privacy/src/index.js';

test('expires transient media seven days after receipt when the journey remains open', () => {
  assert.equal(TRANSIENT_MEDIA_MAX_AGE_DAYS, 7);
  assert.equal(
    resolveTransientMediaExpiresAt({ mediaAt: '2026-08-01T12:00:00.000Z' }),
    '2026-08-08T12:00:00.000Z',
  );
});

test('expires transient media at journey end when it occurs first', () => {
  assert.equal(
    resolveTransientMediaExpiresAt({
      mediaAt: '2026-08-01T12:00:00.000Z',
      journeyEndedAt: '2026-08-03T09:30:00.000Z',
    }),
    '2026-08-03T09:30:00.000Z',
  );
});

test('keeps the seven-day ceiling when the journey ends later', () => {
  assert.equal(
    resolveTransientMediaExpiresAt({
      mediaAt: '2026-08-01T12:00:00.000Z',
      journeyEndedAt: '2026-08-20T09:30:00.000Z',
    }),
    '2026-08-08T12:00:00.000Z',
  );
});

test('makes delayed media immediately eligible when its journey already ended', () => {
  const expiresAt = resolveTransientMediaExpiresAt({
    mediaAt: '2026-08-03T12:00:00.000Z',
    journeyEndedAt: '2026-08-03T10:00:00.000Z',
  });
  assert.equal(expiresAt, '2026-08-03T10:00:00.000Z');
  assert.equal(
    isTransientMediaExpired({
      expiresAt,
      now: '2026-08-03T12:00:00.000Z',
    }),
    true,
  );
});

test('treats the deadline as expired and rejects invalid timestamps', () => {
  assert.equal(
    isTransientMediaExpired({
      expiresAt: '2026-08-08T12:00:00.000Z',
      now: '2026-08-08T12:00:00.000Z',
    }),
    true,
  );
  assert.throws(
    () => resolveTransientMediaExpiresAt({ mediaAt: 'not-a-date' }),
    TransientMediaRetentionError,
  );
  for (const mediaAt of /** @type {any[]} */ ([
    null,
    0,
    '2026-08-01T12:00:00',
  ])) {
    assert.throws(
      () => resolveTransientMediaExpiresAt({ mediaAt }),
      TransientMediaRetentionError,
    );
  }
  assert.throws(
    () =>
      resolveTransientMediaExpiresAt({
        mediaAt: '2026-08-01T12:00:00.000Z',
        journeyEndedAt: 'not-a-date',
      }),
    TransientMediaRetentionError,
  );
});
