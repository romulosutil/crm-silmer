import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const MEDIA_SMOKE_RATE_LIMIT_OPTIONS = Object.freeze({
  global: false,
  max: 120,
  timeWindow: 60000,
});

/**
 * Validate synthetic HTTP media against the worker's private metadata and
 * return only scalar evidence. Network DTOs and downloaded bytes stay in memory.
 * @param {{bytes: Buffer, metadata: Record<string, unknown>, responseMime: string|null, kind: string, origin: string, expectedMime: string}} input
 */
export function verifyMediaSmokeContent(input) {
  const { bytes, metadata, responseMime, kind, origin, expectedMime } = input;
  assert.ok(['image', 'audio', 'video'].includes(kind));
  assert.ok(['attachment', 'recording'].includes(origin));
  assert.ok(
    ['image/png', 'audio/mpeg', 'video/mp4', 'audio/ogg'].includes(
      expectedMime,
    ),
  );
  const limit = kind === 'image' ? 5 * 1024 * 1024 : 16 * 1024 * 1024;
  assert.ok(bytes.length > 0 && bytes.length <= limit);
  const sizeBytes = Number(metadata.size_bytes);
  assert.ok(Number.isSafeInteger(sizeBytes) && sizeBytes === bytes.length);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(metadata.content_sha256, sha256);
  assert.equal(metadata.state, 'attached');
  assert.equal(metadata.origin, origin);
  assert.equal(metadata.detected_mime_type, expectedMime);
  assert.equal(responseMime?.split(';')[0].trim(), expectedMime);
  let durationMs = null;
  if (origin === 'recording') {
    assert.equal(kind, 'audio');
    assert.equal(expectedMime, 'audio/ogg');
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'OggS');
    assert.ok(bytes.subarray(0, 256).includes(Buffer.from('OpusHead')));
    assert.equal(metadata.audio_codec, 'opus');
    assert.equal(metadata.container, 'ogg');
    assert.notEqual(metadata.duration_ms, null);
    durationMs = Number(metadata.duration_ms);
    assert.ok(
      Number.isSafeInteger(durationMs) &&
        durationMs > 0 &&
        durationMs <= 300000,
    );
  }
  // Select constants rather than echoing arbitrary strings from the response.
  return Object.freeze({
    kind: kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'audio',
    origin: origin === 'recording' ? 'recording' : 'attachment',
    state: 'attached',
    mime:
      expectedMime === 'image/png'
        ? 'image/png'
        : expectedMime === 'audio/mpeg'
          ? 'audio/mpeg'
          : expectedMime === 'video/mp4'
            ? 'video/mp4'
            : 'audio/ogg',
    sizeBytes,
    durationMs,
    sha256,
  });
}
