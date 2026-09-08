export const MEDIA_DELETE_JOB_TYPE = 'media.delete';
export const MEDIA_RETENTION_QUEUE = 'media-retention';

/**
 * Deletion is an internal, replay-safe effect: removing an absent private file
 * and marking an already deleted row are both idempotent.
 *
 * @param {{mediaVolume: {delete: Function}, repository: {markDeleted: Function, readForDeletion: Function}}} dependencies
 */
export function createMediaDeleteJobHandler(dependencies) {
  if (
    !dependencies?.mediaVolume ||
    typeof dependencies.mediaVolume.delete !== 'function'
  ) {
    throw new TypeError('Media retention requires delete');
  }
  if (
    !dependencies?.repository ||
    typeof dependencies.repository.markDeleted !== 'function'
  ) {
    throw new TypeError('Media retention requires markDeleted');
  }
  if (typeof dependencies.repository.readForDeletion !== 'function') {
    throw new TypeError('Media retention requires readForDeletion');
  }

  return async function handleMediaDelete(
    /** @type {Record<string, any>} */ job,
  ) {
    const mediaId = technicalId(job?.transientMediaId, 'transientMediaId');
    const reason = deletionReason(job?.deletionReason);
    const media = await dependencies.repository.readForDeletion({ mediaId });
    if (!media || media.availabilityStatus === 'deleted') {
      return Object.freeze({ outcome: 'sent' });
    }
    if (media.storageKey) {
      await dependencies.mediaVolume.delete({
        mediaId,
        reason,
        storageKey: media.storageKey,
      });
    } else {
      await dependencies.repository.markDeleted({
        mediaId,
        now: new Date(),
        reason,
      });
    }
    return Object.freeze({ outcome: 'sent' });
  };
}

/** @param {unknown} value */
function deletionReason(value) {
  if (value !== 'expired' && value !== 'journey_terminal') {
    throw technicalError('INVALID_MEDIA_DELETION_REASON');
  }
  return value;
}

/** @param {unknown} value @param {string} field */
function technicalId(value, field) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    /[\r\n]/u.test(value)
  ) {
    throw technicalError(`INVALID_${field.toUpperCase()}`);
  }
  return value;
}

/** @param {string} code */
function technicalError(code) {
  return Object.assign(new Error(code), { code });
}
