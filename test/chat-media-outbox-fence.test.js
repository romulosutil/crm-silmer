import assert from 'node:assert/strict';
import test from 'node:test';
import { comparableOutbound } from '../modules/n8n-integration/src/postgres-repository.js';

const media = {
  type: 'image',
  media_id: '20000000-0000-4000-8000-000000000001',
  sha256: 'a'.repeat(64),
  mime_type: 'image/png',
  size_bytes: 100,
  caption: 'Caption',
  text: 'Caption',
  filename: null,
  media_url: null,
};
test('T12/MED-06/21: canonical comparison covers reference/hash/MIME/size/caption/type', () => {
  const original = comparableOutbound(media);
  for (const change of [
    { media_id: '20000000-0000-4000-8000-000000000002' },
    { sha256: 'b'.repeat(64) },
    { mime_type: 'image/jpeg' },
    { size_bytes: 101 },
    { caption: 'Other' },
    { type: 'video' },
    { text: 'Other' },
  ])
    assert.notDeepEqual(comparableOutbound({ ...media, ...change }), original);
});
for (const alias of ['attachment_id', 'attachmentId', 'mediaId'])
  test(`T12/MED-21: retained media forbids alias ${alias}`, () => {
    assert.throws(
      () => comparableOutbound({ ...media, [alias]: 'different' }),
      { statusCode: 409 },
    );
  });
test('T12/MED-21: contradictory legacy aliases cannot be silently selected', () => {
  assert.throws(
    () =>
      comparableOutbound({
        type: 'text',
        text: 'Synthetic',
        attachment_id: 'one',
        media_id: 'two',
      }),
    { statusCode: 409 },
  );
});
for (const extra of [
  { media_url: 'https://example.test/private' },
  { filename: 'original.png' },
  { object_key: 'secret-key' },
  { sha256: 'invalid' },
  { size_bytes: 0 },
])
  test(`T12/MED-16/21: arbitrary media metadata ${JSON.stringify(extra)} is refused`, () => {
    assert.throws(() => comparableOutbound({ ...media, ...extra }), {
      statusCode: 409,
    });
  });
test('T12/MED-06: text comparison preserves baseline shape semantics', () => {
  assert.deepEqual(
    comparableOutbound({ type: 'text', text: 'Synthetic' }),
    comparableOutbound({
      type: 'text',
      text: 'Synthetic',
      filename: null,
      media_url: null,
    }),
  );
  assert.notDeepEqual(
    comparableOutbound({ type: 'text', text: 'Changed' }),
    comparableOutbound({ type: 'text', text: 'Synthetic' }),
  );
});
