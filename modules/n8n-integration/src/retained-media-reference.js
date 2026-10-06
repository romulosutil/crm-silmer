import { N8nConflictError } from './errors.js';

/** Metadata comes only from the bound row, never the panel/client content. @param {any} row @param {any} message */
export function retainedMediaReference(row, message) {
  const content = message.content;
  const size = Number(row?.size_bytes);
  const allowedMime = /** @type {Record<string,string[]>} */ ({
    image: ['image/jpeg', 'image/png'],
    audio: ['audio/mpeg', 'audio/mp4', 'audio/ogg'],
    video: ['video/mp4'],
  });
  if (
    !row ||
    row.message_id !== message.id ||
    row.conversation_id !== message.conversationId ||
    row.uploaded_by !== message.actorId ||
    row.state !== 'attached' ||
    row.validation_status !== 'clean' ||
    row.kind !== message.type ||
    typeof content?.mediaId !== 'string' ||
    content.mediaId.toLowerCase() !== row.id ||
    !/^[a-f0-9]{64}$/u.test(row.content_sha256 ?? '') ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > (message.type === 'image' ? 5 : 16) * 1024 * 1024 ||
    !allowedMime[message.type]?.includes(row.detected_mime_type) ||
    Number(row.reservation_bytes) !== 0 ||
    Object.keys(content).some((key) => !['mediaId', 'caption'].includes(key)) ||
    (Object.hasOwn(content, 'caption') &&
      (message.type === 'audio' ||
        typeof content.caption !== 'string' ||
        Array.from(content.caption).length > 1024))
  )
    throw new N8nConflictError(
      'Bound media reference is inconsistent',
      'COMMAND_PAYLOAD_MISMATCH',
    );
  return {
    media_id: row.id,
    sha256: row.content_sha256,
    mime_type: row.detected_mime_type,
    size_bytes: size,
    caption: content.caption ?? null,
  };
}
