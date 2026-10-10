import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import {
  MEDIA_SMOKE_RATE_LIMIT_OPTIONS,
  verifyMediaSmokeContent,
} from '../scripts/media-smoke-security.mjs';

function recordingFixture() {
  const bytes = Buffer.from('OggS synthetic OpusHead');
  return {
    bytes,
    kind: 'audio',
    origin: 'recording',
    expectedMime: 'audio/ogg',
    responseMime: 'audio/ogg',
    metadata: {
      state: 'attached',
      origin: 'recording',
      size_bytes: String(bytes.length),
      content_sha256: createHash('sha256').update(bytes).digest('hex'),
      detected_mime_type: 'audio/ogg',
      duration_ms: '299970',
      audio_codec: 'opus',
      container: 'ogg',
      privateName: 'must never appear in evidence',
    },
  };
}

test('T30/MED-20/23: smoke evidence checks integrity and excludes arbitrary metadata', () => {
  const fixture = recordingFixture();
  const evidence = verifyMediaSmokeContent(fixture);
  assert.deepEqual(evidence, {
    kind: 'audio',
    origin: 'recording',
    state: 'attached',
    mime: 'audio/ogg',
    sizeBytes: fixture.bytes.length,
    durationMs: 299970,
    sha256: fixture.metadata.content_sha256,
  });
  assert.equal(JSON.stringify(evidence).includes('must never appear'), false);
  assert.ok(Object.isFrozen(evidence));
});

for (const [label, field, value] of [
  ['hash mismatch', 'content_sha256', '0'.repeat(64)],
  ['size mismatch', 'size_bytes', 100],
  ['MIME mismatch', 'detected_mime_type', 'application/javascript'],
  ['duration null', 'duration_ms', null],
  ['duration overflow', 'duration_ms', 300001],
  ['codec mismatch', 'audio_codec', 'mp3'],
  ['container mismatch', 'container', 'mp4'],
  ['not attached', 'state', 'ready'],
]) {
  test(`T30/MED-20/23: smoke evidence rejects ${label}`, () => {
    const fixture = recordingFixture();
    assert.throws(() =>
      verifyMediaSmokeContent({
        ...fixture,
        metadata: { ...fixture.metadata, [String(field)]: value },
      }),
    );
  });
}

test('T30/MED-20/23: matching hash does not excuse invalid OGG bytes or HTTP MIME', () => {
  const fixture = recordingFixture();
  const bytes = Buffer.from('synthetic invalid format');
  assert.throws(() =>
    verifyMediaSmokeContent({
      ...fixture,
      bytes,
      metadata: {
        ...fixture.metadata,
        size_bytes: String(bytes.length),
        content_sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    }),
  );
  assert.throws(() =>
    verifyMediaSmokeContent({ ...fixture, responseMime: 'text/html' }),
  );
});

test('T30/MED-23: flood is rejected before the database side-effect hook', async (t) => {
  const api = Fastify();
  t.after(() => api.close());
  await api.register(rateLimit, MEDIA_SMOKE_RATE_LIMIT_OPTIONS);
  api.addHook('onRequest', api.rateLimit());
  let mutations = 0;
  api.addHook('onRequest', async () => {
    mutations++;
  });
  api.get('/commands/synthetic/media', async () => ({ ok: true }));
  for (let n = 0; n < MEDIA_SMOKE_RATE_LIMIT_OPTIONS.max; n++) {
    assert.equal(
      (await api.inject('/commands/synthetic/media')).statusCode,
      200,
    );
  }
  const refused = await api.inject('/commands/synthetic/media');
  assert.equal(refused.statusCode, 429);
  assert.equal(mutations, MEDIA_SMOKE_RATE_LIMIT_OPTIONS.max);
  assert.equal(refused.headers['retry-after'], '60');
});
