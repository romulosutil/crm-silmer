import { readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setInterval, clearInterval } from 'node:timers';

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

/** Deletes only unbound orphan bytes while retaining authoritative locks. */
export class PostgresChatMediaDraftCleanup {
  /** @param {{database:any,store:any,spoolRoot:string,bucketAlias:string,removeFile?:Function,removeDirectory?:Function}} options */
  constructor({
    database,
    store,
    spoolRoot,
    bucketAlias,
    removeFile = (/** @type {string} */ path) => rm(path, { force: true }),
    removeDirectory = (/** @type {string} */ path) =>
      rm(path, { recursive: true, force: true }),
  }) {
    this.database = database;
    this.store = store;
    this.root = resolve(spoolRoot);
    this.bucketAlias = bucketAlias;
    this.removeFile = removeFile;
    this.removeDirectory = removeDirectory;
  }
  /** @param {string} key */
  async removeIntermediates(key) {
    if (!UUID.test(key)) throw new Error('Invalid intermediate owner');
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if (/** @type {any} */ (error).code === 'ENOENT') return;
      throw error;
    }
    const owned = new RegExp(`^\\.recording-${key}-[A-Za-z0-9]{6}$`, 'u');
    for (const entry of entries) {
      if (!owned.test(entry.name)) continue;
      if (!entry.isDirectory())
        throw new Error('Unexpected owned intermediate');
      // The exact UUID plus mkdtemp suffix contains no path separators.
      const directory = resolve(this.root, entry.name);
      if (dirname(directory) !== this.root)
        throw new Error('Intermediate escaped spool');
      await this.removeDirectory(directory);
    }
  }
  /** @param {unknown} key */
  async removeSpool(key) {
    if (key === null) return;
    if (typeof key !== 'string' || !UUID.test(key))
      throw new Error('Invalid orphan spool key');
    await this.removeFile(join(this.root, key));
  }
  async runOnce() {
    const drafts = (
      await this.database.query(
        `SELECT id FROM crm.chat_media WHERE message_id IS NULL AND reservation_bytes>0 AND created_at<now()-interval '24 hours' AND storage_bucket_alias=$1 ORDER BY created_at,id LIMIT 100`,
        [this.bucketAlias],
      )
    ).rows;
    for (const draft of drafts) {
      try {
        await this.database.transaction(async (/** @type {any} */ client) => {
          await client.query("SET LOCAL lock_timeout='2s'");
          const guard = (
            await client.query(
              'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
              [`media-writer:${draft.id}`],
            )
          ).rows[0];
          if (!guard.acquired) return;
          // Same order as processing: job, media, quota. SKIP LOCKED also avoids
          // holding a job lock while a concurrent attachment owns the media.
          const job = (
            await client.query(
              `SELECT * FROM crm.outbox_jobs WHERE chat_media_id=$1 AND job_type='chat_media.process' FOR UPDATE SKIP LOCKED`,
              [draft.id],
            )
          ).rows[0];
          if (!job || job.status === 'processing') return;
          const row = (
            await client.query(
              `SELECT * FROM crm.chat_media WHERE id=$1 AND message_id IS NULL AND reservation_bytes>0 AND created_at<now()-interval '24 hours' AND storage_bucket_alias=$2 AND (processing_guard_until IS NULL OR processing_guard_until<=now()) FOR UPDATE SKIP LOCKED`,
              [draft.id, this.bucketAlias],
            )
          ).rows[0];
          if (!row) return;
          // Commit non-bindable intent before external DELETE. A later SQL or
          // COMMIT failure must never restore ready after bytes were removed.
          await client.query(
            `UPDATE crm.chat_media SET cleanup_started_at=COALESCE(cleanup_started_at,now()),state='unavailable',sanitized_reason='processing_failed',version=version+1 WHERE id=$1`,
            [row.id],
          );
          await client.query(
            `UPDATE crm.outbox_jobs SET status='completed',completed_at=now(),updated_at=now() WHERE id=$1`,
            [job.id],
          );
        });
        await this.database.transaction(async (/** @type {any} */ client) => {
          await client.query("SET LOCAL lock_timeout='2s'");
          const guard = (
            await client.query(
              'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
              [`media-writer:${draft.id}`],
            )
          ).rows[0];
          if (!guard.acquired) return;
          const job = (
            await client.query(
              `SELECT id FROM crm.outbox_jobs WHERE chat_media_id=$1 AND job_type='chat_media.process' AND status='completed' FOR UPDATE SKIP LOCKED`,
              [draft.id],
            )
          ).rows[0];
          if (!job) return;
          const row = (
            await client.query(
              `SELECT * FROM crm.chat_media WHERE id=$1 AND message_id IS NULL AND reservation_bytes>0 AND cleanup_started_at IS NOT NULL AND state='unavailable' AND storage_bucket_alias=$2 AND (processing_guard_until IS NULL OR processing_guard_until<=now()) FOR UPDATE SKIP LOCKED`,
              [draft.id, this.bucketAlias],
            )
          ).rows[0];
          if (!row) return;
          await client.query(
            'SELECT bucket_alias FROM crm.chat_media_quotas WHERE bucket_alias=$1 FOR UPDATE',
            [row.storage_bucket_alias],
          );
          await this.removeSpool(row.spool_key);
          if (row.origin === 'recording' && row.object_key !== row.spool_key)
            await this.removeSpool(row.object_key);
          if (row.origin === 'recording')
            await this.removeIntermediates(row.object_key);
          // Even failed/uncertain PUT may have published an immutable object.
          await this.store.deleteDraft(row.object_key);
          await client.query(
            `UPDATE crm.chat_media_quotas SET reserved_bytes=reserved_bytes-$2,version=version+1,updated_at=now() WHERE bucket_alias=$1`,
            [row.storage_bucket_alias, row.reservation_bytes],
          );
          await client.query(
            `UPDATE crm.chat_media SET state='lost',sanitized_reason='object_missing',reservation_bytes=0,spool_key=NULL,version=version+1 WHERE id=$1`,
            [row.id],
          );
        });
      } catch {
        /* Keep reservation and metadata for cleanup-only retry. */
      }
    }
    const admissions = (
      await this.database.query(
        `SELECT id FROM crm.chat_media_admissions WHERE state='receiving' AND bucket_alias=$1 AND created_at<now()-interval '24 hours' ORDER BY created_at,id LIMIT 100`,
        [this.bucketAlias],
      )
    ).rows;
    for (const admission of admissions) {
      try {
        await this.database.transaction(async (/** @type {any} */ client) => {
          const lease = (
            await client.query(
              'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
              [`media-writer:${admission.id}`],
            )
          ).rows[0];
          if (!lease.acquired) return;
          const row = (
            await client.query(
              `SELECT * FROM crm.chat_media_admissions WHERE id=$1 AND state='receiving' AND created_at<now()-interval '24 hours' AND bucket_alias=$2 AND (writer_guard_until IS NULL OR writer_guard_until<=now()) FOR UPDATE SKIP LOCKED`,
              [admission.id, this.bucketAlias],
            )
          ).rows[0];
          if (!row) return;
          await client.query(
            'SELECT bucket_alias FROM crm.chat_media_quotas WHERE bucket_alias=$1 FOR UPDATE',
            [row.bucket_alias],
          );
          await this.removeSpool(row.id);
          await client.query(
            'UPDATE crm.chat_media_quotas SET reserved_bytes=reserved_bytes-$2,version=version+1,updated_at=now() WHERE bucket_alias=$1',
            [row.bucket_alias, row.reservation_bytes],
          );
          await client.query(
            `UPDATE crm.chat_media_admissions SET state='cleaned',reservation_bytes=0 WHERE id=$1`,
            [row.id],
          );
        });
      } catch {
        /* A busy/missing dependency must never free unremoved bytes. */
      }
    }
  }
}

/** Independent cleanup polling never enqueues an outbound send. */
export class ChatMediaDraftCleanupScheduler {
  /** @param {{cleanup:{runOnce:Function},intervalMs?:number}} options */
  constructor({ cleanup, intervalMs = 60_000 }) {
    this.cleanup = cleanup;
    this.intervalMs = intervalMs;
    /** @type {ReturnType<typeof setInterval>|undefined} */ this.timer =
      undefined;
    /** @type {Promise<void>|undefined} */ this.inFlight = undefined;
  }
  async start() {
    if (this.timer) return;
    const tick = () => {
      if (!this.inFlight)
        this.inFlight = Promise.resolve()
          .then(() => this.cleanup.runOnce())
          .catch(() => undefined)
          .finally(() => {
            this.inFlight = undefined;
          });
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
    this.timer.unref();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }
}
