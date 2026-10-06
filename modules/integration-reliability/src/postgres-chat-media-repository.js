/**
 * Media processing transactions lock the active job/attempt before media and
 * quota. Prepared metadata survives uncertain PUT and the reservation remains
 * charged until confirmed spool cleanup. Attachment binding is a separate API
 * transaction and is the only transition that moves reserved bytes into used.
 */
export class PostgresChatMediaRepository {
  #database;
  /** @param {{database: {transaction: Function,connection:Function}}} options */
  constructor({ database }) {
    this.#database = database;
  }

  /** Protect physical readers/writers even after job heartbeat is lost.
   * @param {string} mediaId @param {Function} work */
  async withProcessingLease(mediaId, work) {
    return this.#database.connection(async (/** @type {any} */ client) => {
      const controller = new AbortController();
      const lost = () => controller.abort();
      let guarded = false;
      client.on('error', lost);
      client.on('end', lost);
      try {
        await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [
          `media-writer:${mediaId}`,
        ]);
        const marked = await client.query(
          `UPDATE crm.chat_media SET processing_guard_until=now()+interval '15 minutes' WHERE id=$1 AND message_id IS NULL AND cleanup_started_at IS NULL RETURNING id`,
          [mediaId],
        );
        guarded = marked.rows.length === 1;
        return await work(controller.signal);
      } finally {
        try {
          // All children and file streams must be closed before this callback ends.
          if (guarded)
            await client.query(
              'UPDATE crm.chat_media SET processing_guard_until=NULL WHERE id=$1',
              [mediaId],
            );
        } finally {
          try {
            const row = (
              await client.query(
                'SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released',
                [`media-writer:${mediaId}`],
              )
            ).rows[0];
            if (!row.released) throw new Error('Media processing guard lost');
          } finally {
            client.off('error', lost);
            client.off('end', lost);
          }
        }
      }
    });
  }

  /** @param {Record<string,any>} job @param {Function} work */
  async #owned(job, work) {
    return this.#database.transaction(async (/** @type {any} */ client) => {
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query("SET LOCAL lock_timeout='2s'");
      const owned = await client.query(
        `SELECT j.id FROM crm.outbox_jobs j
        JOIN crm.processing_attempts a ON a.job_id=j.id AND a.id=$2
        WHERE j.id=$1 AND j.chat_media_id=$3 AND j.job_type='chat_media.process'
          AND j.status='processing' AND j.locked_until>now()
          AND j.queue='chat_media' AND j.effect_policy='internal'
          AND a.state='claimed' AND a.worker_id=j.locked_by
        FOR UPDATE OF j,a`,
        [job.id, job.attemptId, job.chatMediaId],
      );
      if (!owned.rows.length) return null;
      return work(client);
    });
  }

  /** @param {Record<string,any>} job */
  async acquire(job) {
    return this.#owned(job, async (/** @type {any} */ client) => {
      const result = await client.query(
        'SELECT * FROM crm.chat_media WHERE id=$1 FOR UPDATE',
        [job.chatMediaId],
      );
      const row = result.rows[0];
      if (row?.cleanup_started_at) return null;
      if (!row || ['ready', 'attached', 'rejected', 'lost'].includes(row.state))
        return row ?? null;
      if (
        row.message_id ||
        (row.state === 'processing' &&
          row.processing_attempt_id === job.attemptId)
      )
        return null;
      const claimed = await client.query(
        `UPDATE crm.chat_media SET state='processing',
        processing_attempt_id=$2, sanitized_reason=NULL,version=version+1
        WHERE id=$1 AND version=$3 AND message_id IS NULL RETURNING *`,
        [row.id, job.attemptId, row.version],
      );
      return claimed.rows[0] ?? null;
    });
  }

  /** @param {Record<string,any>} job @param {Record<string,any>} row @param {Record<string,any>} metadata */
  async prepare(job, row, metadata) {
    return this.#owned(job, async (/** @type {any} */ client) => {
      const updated = await client.query(
        `UPDATE crm.chat_media SET original_sha256=COALESCE(original_sha256,$4),
        content_sha256=$5,size_bytes=$6,detected_mime_type=$7,container=$8,
        audio_codec=$9,video_codec=$10,duration_ms=$11,validation_status='clean',
        sanitized_reason=NULL,version=version+1
        WHERE id=$1 AND version=$2 AND processing_attempt_id=$3 AND state='processing'
          AND message_id IS NULL AND content_sha256 IS NULL
          AND (original_sha256 IS NULL OR original_sha256=$4) RETURNING *`,
        [
          row.id,
          row.version,
          job.attemptId,
          metadata.originalSha256,
          metadata.sha256,
          metadata.sizeBytes,
          metadata.mimeType,
          metadata.container,
          metadata.audioCodec,
          metadata.videoCodec,
          metadata.durationMs,
        ],
      );
      return updated.rows[0] ?? null;
    });
  }

  /** @param {Record<string,any>} job @param {Record<string,any>} row */
  async ready(job, row) {
    return this.#owned(job, async (/** @type {any} */ client) => {
      const locked = await client.query(
        `SELECT * FROM crm.chat_media WHERE id=$1
        AND version=$2 AND processing_attempt_id=$3 AND state='processing' AND message_id IS NULL
        FOR UPDATE`,
        [row.id, row.version, job.attemptId],
      );
      const media = locked.rows[0];
      if (!media) return false;
      const quota = await client.query(
        'SELECT * FROM crm.chat_media_quotas WHERE bucket_alias=$1 FOR UPDATE',
        [media.storage_bucket_alias],
      );
      const counter = quota.rows[0];
      const reservation = Number(media.reservation_bytes);
      const size = Number(media.size_bytes);
      if (
        !counter ||
        Number(counter.reserved_bytes) < reservation ||
        size > reservation ||
        size < 1
      )
        throw new Error('Media reservation is inconsistent');
      await client.query(
        `UPDATE crm.chat_media_quotas SET reserved_bytes=reserved_bytes-$2+$3,
        version=version+1,updated_at=now() WHERE bucket_alias=$1`,
        [media.storage_bucket_alias, reservation, size],
      );
      await client.query(
        `UPDATE crm.chat_media SET state='ready',validation_status='clean',reservation_bytes=$2,
        processed_at=now(),sanitized_reason=NULL,version=version+1 WHERE id=$1`,
        [media.id, size],
      );
      return true;
    });
  }

  /** @param {Record<string,any>} job @param {Record<string,any>} row @param {string} reason */
  async fail(job, row, reason) {
    const terminal = ['infected', 'invalid_format'].includes(reason);
    const validation =
      reason === 'infected'
        ? 'infected'
        : reason === 'invalid_format'
          ? 'invalid_format'
          : reason === 'stale_signatures'
            ? 'stale_signatures'
            : 'error';
    return this.#owned(job, async (/** @type {any} */ client) => {
      const result = await client.query(
        `UPDATE crm.chat_media SET state=$4,validation_status=$5,
        sanitized_reason=$6,version=version+1 WHERE id=$1 AND version=$2
        AND processing_attempt_id=$3 AND state='processing' AND message_id IS NULL RETURNING id`,
        [
          row.id,
          row.version,
          job.attemptId,
          terminal ? 'rejected' : 'unavailable',
          validation,
          reason,
        ],
      );
      return result.rows.length === 1;
    });
  }
}
