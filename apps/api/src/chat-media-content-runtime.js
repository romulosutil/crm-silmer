import { Transform } from 'node:stream';
import { mediaError } from './chat-media-runtime.js';

/** @param {any} dependencies @param {any} input */
export async function readChatMediaContent(
  { repository, store, bucketAlias },
  input,
) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      input.mediaId,
    )
  )
    throw mediaError(404);
  const row = await repository.readForActor(input);
  if (row.state === 'lost') throw mediaError(410);
  if (row.state === 'unavailable') throw mediaError(503);
  if (
    !['ready', 'attached'].includes(row.state) ||
    row.validation_status !== 'clean'
  )
    throw mediaError(409);
  const size = Number(row.size_bytes);
  if (
    !store ||
    row.storage_bucket_alias !== bucketAlias ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    !/^[a-f0-9]{64}$/u.test(row.content_sha256 ?? '')
  )
    throw mediaError(503);
  let start = 0;
  let end = size - 1;
  if (input.range !== undefined) {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(input.range);
    const invalid = () =>
      Object.assign(mediaError(416), { contentRange: `bytes */${size}` });
    if (!match || (!match[1] && !match[2])) throw invalid();
    const first = Number(match[1]);
    const last = Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last))
      throw invalid();
    if (!match[1]) {
      if (last < 1) throw invalid();
      start = Math.max(0, size - last);
    } else {
      start = first;
      end = match[2] ? Math.min(last, size - 1) : size - 1;
    }
    if (start >= size || end < start) throw invalid();
  }
  const expectedLength = end - start + 1;
  const contentRange =
    input.range === undefined ? null : `bytes ${start}-${end}/${size}`;
  const matches = (
    /** @type {any} */ metadata,
    /** @type {number} */ expected,
  ) =>
    metadata.sizeBytes === expected &&
    metadata.sha256 === row.content_sha256 &&
    metadata.mimeType === row.detected_mime_type;
  let object;
  try {
    const head = await store.head(row.object_key);
    if (!matches(head, size)) throw mediaError(503);
    object = await store.read(
      row.object_key,
      contentRange ? `bytes=${start}-${end}` : undefined,
    );
    if (
      !matches(object, expectedLength) ||
      object.contentRange !== contentRange
    ) {
      object.stream.destroy();
      throw mediaError(503);
    }
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'MEDIA_OBJECT_MISSING') {
      // CAS protects a concurrent replacement/cleanup; quota stays untouched.
      if (await repository.markLost(row)) throw mediaError(410);
    }
    throw mediaError(503);
  }
  let transferred = 0;
  const bounded = new Transform({
    transform(chunk, _encoding, callback) {
      transferred += chunk.length;
      callback(transferred > expectedLength ? mediaError(503) : null, chunk);
    },
    flush(callback) {
      callback(transferred === expectedLength ? null : mediaError(503));
    },
  });
  object.stream.on('error', () => bounded.destroy(mediaError(503)));
  bounded.on('close', () => object.stream.destroy());
  object.stream.pipe(bounded);
  return {
    statusCode: contentRange ? 206 : 200,
    stream: bounded,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      'Content-Type': row.detected_mime_type,
      'Content-Length': String(expectedLength),
      ...(contentRange ? { 'Content-Range': contentRange } : {}),
    },
  };
}
