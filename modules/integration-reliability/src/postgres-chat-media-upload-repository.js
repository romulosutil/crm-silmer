import { createHash, randomUUID } from 'node:crypto';

/** @param {number} statusCode */
function error(statusCode) {
  return Object.assign(new Error('Media admission failed'), { statusCode });
}
/** Admission owns its reservation until confirmed spool cleanup or atomic conversion to media. */
export class PostgresChatMediaUploadRepository {
  #database;
  #bucketAlias;
  #limitBytes;
  /** @param {{database:any,bucketAlias?:string,limitBytes?:number}} options */
  constructor({
    database,
    bucketAlias = 'chat-dev',
    limitBytes = 1024 * 1024 * 1024,
  }) {
    if (
      !['chat-dev', 'chat-operational'].includes(bucketAlias) ||
      !Number.isSafeInteger(limitBytes) ||
      limitBytes < 1
    )
      throw new TypeError('Invalid chat media quota');
    this.#database = database;
    this.#bucketAlias = bucketAlias;
    this.#limitBytes = limitBytes;
  }
  /** @param {any} client @param {any} input */
  async #conversation(client, input, checkState = true) {
    const row = (
      await client.query(
        'SELECT id,version,terminal_at,assigned_user_id FROM crm.conversations WHERE id=$1 FOR UPDATE',
        [input.conversationId],
      )
    ).rows[0];
    if (
      !row ||
      (checkState &&
        (Number(row.version) !== input.expectedVersion ||
          row.terminal_at !== null))
    )
      throw error(409);
    if (
      row.assigned_user_id &&
      row.assigned_user_id !== input.actor.id &&
      !input.actor.capabilities?.includes('COMMERCIAL_ADMIN')
    )
      throw error(403);
  }
  /** @param {any} input */
  async admit(input) {
    const sessionHash = createHash('sha256')
      .update(input.sessionHash)
      .digest('hex');
    return this.#database.transaction(async (/** @type {any} */ client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`media-session:${sessionHash}`],
      );
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [
          JSON.stringify([
            'media-upload',
            input.actor.id,
            input.conversationId,
            input.idempotencyKey,
          ]),
        ],
      );
      const existing = (
        await client.query(
          `SELECT id,request_fingerprint FROM crm.chat_media WHERE uploaded_by=$1 AND conversation_id=$2 AND upload_command_id=$3`,
          [input.actor.id, input.conversationId, input.idempotencyKey],
        )
      ).rows[0];
      await this.#conversation(client, input, !existing);
      const active = (
        await client.query(
          `SELECT id FROM crm.chat_media_admissions WHERE uploaded_by=$1 AND conversation_id=$2 AND upload_command_id=$3 AND state='receiving'`,
          [input.actor.id, input.conversationId, input.idempotencyKey],
        )
      ).rows[0];
      if (active) throw error(409);
      await client.query(
        `INSERT INTO crm.chat_media_quotas(bucket_alias,limit_bytes) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [this.#bucketAlias, this.#limitBytes],
      );
      const quota = (
        await client.query(
          'SELECT * FROM crm.chat_media_quotas WHERE bucket_alias=$1 FOR UPDATE',
          [this.#bucketAlias],
        )
      ).rows[0];
      const recent = (
        await client.query(
          `SELECT count(*)::int AS count FROM crm.chat_media_admissions WHERE session_hash=$1 AND created_at>now()-interval '1 minute'`,
          [sessionHash],
        )
      ).rows[0];
      if (
        recent.count >= 12 ||
        (!existing &&
          Number(quota.used_bytes) +
            Number(quota.reserved_bytes) +
            input.reservationBytes >
            Number(quota.limit_bytes))
      )
        throw error(429);
      if (existing) {
        await client.query(
          `INSERT INTO crm.chat_media_admissions(id,conversation_id,uploaded_by,upload_command_id,session_hash,bucket_alias,reservation_bytes,state) VALUES($1,$2,$3,$4,$5,$6,0,'cleaned')`,
          [
            input.id,
            input.conversationId,
            input.actor.id,
            input.idempotencyKey,
            sessionHash,
            this.#bucketAlias,
          ],
        );
        return { replay: existing };
      }
      await client.query(
        'UPDATE crm.chat_media_quotas SET reserved_bytes=reserved_bytes+$2,version=version+1,updated_at=now() WHERE bucket_alias=$1',
        [this.#bucketAlias, input.reservationBytes],
      );
      await client.query(
        `INSERT INTO crm.chat_media_admissions(id,conversation_id,uploaded_by,upload_command_id,session_hash,bucket_alias,reservation_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          input.id,
          input.conversationId,
          input.actor.id,
          input.idempotencyKey,
          sessionHash,
          this.#bucketAlias,
          input.reservationBytes,
        ],
      );
      return { id: input.id };
    });
  }
  /** @param {any} input */
  async complete(input) {
    return this.#database.transaction(async (/** @type {any} */ client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [
          JSON.stringify([
            'media-upload',
            input.actor.id,
            input.conversationId,
            input.idempotencyKey,
          ]),
        ],
      );
      const admission = (
        await client.query(
          `SELECT * FROM crm.chat_media_admissions WHERE id=$1 AND state='receiving' FOR UPDATE`,
          [input.id],
        )
      ).rows[0];
      if (
        !admission ||
        admission.uploaded_by !== input.actor.id ||
        admission.conversation_id !== input.conversationId
      )
        throw error(409);
      const existing = (
        await client.query(
          `SELECT id,request_fingerprint FROM crm.chat_media WHERE uploaded_by=$1 AND conversation_id=$2 AND upload_command_id=$3`,
          [input.actor.id, input.conversationId, input.idempotencyKey],
        )
      ).rows[0];
      if (existing) {
        if (existing.request_fingerprint !== input.fingerprint)
          throw error(409);
        return { mediaId: existing.id, duplicate: true };
      }
      await this.#conversation(client, input);
      await client.query(
        'SELECT bucket_alias FROM crm.chat_media_quotas WHERE bucket_alias=$1 FOR UPDATE',
        [admission.bucket_alias],
      );
      await client.query(
        `INSERT INTO crm.chat_media(id,conversation_id,uploaded_by,upload_command_id,request_fingerprint,kind,origin,filename_envelope,spool_key,storage_bucket_alias,input_size_bytes,reservation_bytes,original_sha256,declared_mime_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$1,$9,$10,$11,$12,$13)`,
        [
          input.id,
          input.conversationId,
          input.actor.id,
          input.idempotencyKey,
          input.fingerprint,
          input.kind,
          input.origin,
          JSON.stringify(input.filenameEnvelope),
          admission.bucket_alias,
          input.sizeBytes,
          input.reservationBytes,
          input.sha256,
          input.declaredMimeType,
        ],
      );
      await client.query(
        `INSERT INTO crm.outbox_jobs(id,queue,job_type,chat_media_id,idempotency_key,effect_policy,available_at,created_at) VALUES($1,'chat_media','chat_media.process',$2,$3,'internal',now(),now())`,
        [`job-${randomUUID()}`, input.id, `chat-media:${input.id}`],
      );
      await client.query(
        'UPDATE crm.chat_media_quotas SET reserved_bytes=reserved_bytes-$2+$3,version=version+1,updated_at=now() WHERE bucket_alias=$1',
        [
          admission.bucket_alias,
          admission.reservation_bytes,
          input.reservationBytes,
        ],
      );
      await client.query(
        `UPDATE crm.chat_media_admissions SET state='consumed',reservation_bytes=0,media_id=$2 WHERE id=$1`,
        [input.id, input.id],
      );
      return { mediaId: input.id, duplicate: false };
    });
  }
  /** Call only after confirmed removal of the UUID spool. @param {string} id */
  async cleanupDisposition(id) {
    return this.#database.transaction(async (/** @type {any} */ client) => {
      const row = (
        await client.query(
          'SELECT state FROM crm.chat_media_admissions WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      return row?.state ?? 'unknown';
    });
  }
  /** Call only after confirmed removal of the UUID spool. @param {string} id */
  async release(id) {
    await this.#database.transaction(async (/** @type {any} */ client) => {
      const row = (
        await client.query(
          `SELECT * FROM crm.chat_media_admissions WHERE id=$1 AND state='receiving' FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!row) return;
      await client.query(
        'UPDATE crm.chat_media_quotas SET reserved_bytes=reserved_bytes-$2,version=version+1,updated_at=now() WHERE bucket_alias=$1',
        [row.bucket_alias, row.reservation_bytes],
      );
      await client.query(
        `UPDATE crm.chat_media_admissions SET state='cleaned',reservation_bytes=0 WHERE id=$1`,
        [id],
      );
    });
  }
  /** T22 discovery only: cleanup must lock/recheck receiving state before deletion. @param {number} [limit] */
  async listAbandonedAdmissions(limit = 100) {
    return (
      await this.#database.query(
        `SELECT id,bucket_alias,reservation_bytes FROM crm.chat_media_admissions WHERE state='receiving' AND created_at<now()-interval '24 hours' ORDER BY created_at,id LIMIT $1`,
        [limit],
      )
    ).rows;
  }
}
