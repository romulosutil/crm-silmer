const MAX_TRANSIENT_MEDIA_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class TransientMediaRetentionError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'TransientMediaRetentionError';
    this.code = 'INVALID_TRANSIENT_MEDIA_RETENTION_INPUT';
  }
}

/** @param {string | Date} value @param {string} field */
function timestamp(value, field) {
  if (!(value instanceof Date) && typeof value !== 'string') {
    throw new TransientMediaRetentionError(
      `${field} must be an absolute timestamp`,
    );
  }
  if (
    typeof value === 'string' &&
    !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value)
  ) {
    throw new TransientMediaRetentionError(
      `${field} must include an explicit UTC offset`,
    );
  }
  const parsed =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TransientMediaRetentionError(
      `${field} must be a valid timestamp`,
    );
  }
  return parsed;
}

/**
 * Returns the earliest deletion deadline for transient inbound/outbound media.
 * Media remains eligible for immediate deletion when a terminal journey event
 * was observed before a delayed provider download reached the CRM.
 *
 * @param {{ mediaAt: string | Date, journeyEndedAt?: string | Date | null }} input
 * @returns {string}
 */
export function resolveTransientMediaExpiresAt({
  mediaAt,
  journeyEndedAt = null,
}) {
  const receivedOrSentAt = timestamp(mediaAt, 'mediaAt');
  const maximumDeadline = new Date(
    receivedOrSentAt.getTime() + MAX_TRANSIENT_MEDIA_AGE_MS,
  );
  if (journeyEndedAt === null || journeyEndedAt === undefined) {
    return maximumDeadline.toISOString();
  }

  const journeyDeadline = timestamp(journeyEndedAt, 'journeyEndedAt');
  return new Date(
    Math.min(maximumDeadline.getTime(), journeyDeadline.getTime()),
  ).toISOString();
}

/**
 * @param {{ expiresAt: string | Date, now?: string | Date }} input
 * @returns {boolean}
 */
export function isTransientMediaExpired({ expiresAt, now = new Date() }) {
  return (
    timestamp(now, 'now').getTime() >=
    timestamp(expiresAt, 'expiresAt').getTime()
  );
}

export const TRANSIENT_MEDIA_MAX_AGE_DAYS = 7;
